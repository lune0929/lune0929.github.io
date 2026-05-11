import { useEffect, useState } from "react";
import AccidentHotspotMapPage from "./pages/AccidentHotspotMapPage";
import HomePage from "./pages/HomePage";
import HighwayTollOfficeEditPage from "./pages/HighwayTollOfficeEditPage";
import HighwayTollOfficeMapPage from "./pages/HighwayTollOfficeMapPage";
import HeavyFactoryMapPage from "./pages/HeavyFactoryMapPage";
import IndustrialComplexBoundaryMapPage from "./pages/IndustrialComplexBoundaryMapPage";
import LogisticsWarehouseMapPage from "./pages/LogisticsWarehouseMapPage";
import OverloadCheckpointMapPage from "./pages/OverloadCheckpointMapPage";
import PortAreaMapPage from "./pages/PortAreaMapPage";
import RestAreaMapPage from "./pages/RestAreaMapPage";
import ScaleOfficeEditPage from "./pages/ScaleOfficeEditPage";
import ScaleOfficeMapPage from "./pages/ScaleOfficeMapPage";
import TruckAccidentHotspotMapPage from "./pages/TruckAccidentHotspotMapPage";

type Route =
  | "/"
  | "/scale-offices"
  | "/scale-offices/edit"
  | "/highway-toll-offices"
  | "/highway-toll-offices/edit"
  | "/heavy-factories"
  | "/industrial-complex-boundaries"
  | "/logistics-warehouses"
  | "/overload-checkpoints"
  | "/port-areas"
  | "/rest-areas"
  | "/truck-accident-hotspots"
  | "/accident-hotspots";

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  if (
    hash === "/scale-offices" ||
    hash === "/scale-offices/edit" ||
    hash === "/highway-toll-offices" ||
    hash === "/highway-toll-offices/edit" ||
    hash === "/heavy-factories" ||
    hash === "/industrial-complex-boundaries" ||
    hash === "/logistics-warehouses" ||
    hash === "/overload-checkpoints" ||
    hash === "/port-areas" ||
    hash === "/rest-areas" ||
    hash === "/truck-accident-hotspots" ||
    hash === "/accident-hotspots"
  ) {
    return hash;
  }
  return "/";
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => getRouteFromHash());

  useEffect(() => {
    const handleHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (route === "/scale-offices") {
    return <ScaleOfficeMapPage />;
  }

  if (route === "/scale-offices/edit") {
    return <ScaleOfficeEditPage />;
  }

  if (route === "/highway-toll-offices") {
    return <HighwayTollOfficeMapPage />;
  }

  if (route === "/highway-toll-offices/edit") {
    return <HighwayTollOfficeEditPage />;
  }

  if (route === "/heavy-factories") {
    return <HeavyFactoryMapPage />;
  }

  if (route === "/industrial-complex-boundaries") {
    return <IndustrialComplexBoundaryMapPage />;
  }

  if (route === "/logistics-warehouses") {
    return <LogisticsWarehouseMapPage />;
  }

  if (route === "/overload-checkpoints") {
    return <OverloadCheckpointMapPage />;
  }

  if (route === "/port-areas") {
    return <PortAreaMapPage />;
  }

  if (route === "/rest-areas") {
    return <RestAreaMapPage />;
  }

  if (route === "/truck-accident-hotspots") {
    return <TruckAccidentHotspotMapPage />;
  }

  if (route === "/accident-hotspots") {
    return <AccidentHotspotMapPage />;
  }

  return <HomePage />;
}
