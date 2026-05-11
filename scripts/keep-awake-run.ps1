param(
    [string]$Pattern = "classify-heavy-factories|geocode:heavy-factories",
    [int]$IntervalSeconds = 30
)

# 이미 SleepUtil 타입이 등록되어 있으면 다시 Add-Type 하지 않음
if (-not ("SleepUtil" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SleepUtil {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern UInt32 SetThreadExecutionState(UInt32 esFlags);
}
"@
}

# Windows 절전 방지 플래그
# UInt32(Unsigned Integer 32-bit: 부호 없는 32비트 정수)로 명시해야 PowerShell 음수 변환 오류가 안 남
[UInt32]$ES_CONTINUOUS = 2147483648
[UInt32]$ES_SYSTEM_REQUIRED = 1
[UInt32]$ES_DISPLAY_REQUIRED = 2
[UInt32]$AWAKE_FLAGS = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED

function Get-TargetProcesses {
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match $Pattern -and
            $_.ProcessId -ne $PID
        } |
        Select-Object ProcessId, Name, CommandLine
}

try {
    Write-Host "[KEEP-AWAKE-MONITOR] 감시 시작"
    Write-Host "[KEEP-AWAKE-MONITOR] 대상 패턴: $Pattern"
    Write-Host "[KEEP-AWAKE-MONITOR] 기존 작업을 다시 실행하지 않습니다."
    Write-Host "[KEEP-AWAKE-MONITOR] 대상 프로세스가 살아있는 동안 절전/화면꺼짐을 방지합니다."
    Write-Host ""

    while ($true) {
        $targets = @(Get-TargetProcesses)

        if ($targets.Count -eq 0) {
            Write-Host "[KEEP-AWAKE-MONITOR] 대상 프로세스가 없습니다. 감시를 종료합니다."
            break
        }

        # 절전/화면꺼짐 방지 신호 전송
        [SleepUtil]::SetThreadExecutionState($AWAKE_FLAGS) | Out-Null

        $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $pids = ($targets | ForEach-Object {
            "$($_.Name):$($_.ProcessId)"
        }) -join ", "

        Write-Host "[KEEP-AWAKE-MONITOR] $now 실행 중: $pids"

        Start-Sleep -Seconds $IntervalSeconds
    }
}
finally {
    # 절전 방지 해제
    [SleepUtil]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
    Write-Host "[KEEP-AWAKE-MONITOR] 절전 방지 해제"
}