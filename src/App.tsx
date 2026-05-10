import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import HighwayTollOfficeEditPage from "./pages/HighwayTollOfficeEditPage";
import HighwayTollOfficeMapPage from "./pages/HighwayTollOfficeMapPage";
import OverloadCheckpointMapPage from "./pages/OverloadCheckpointMapPage";
import ScaleOfficeEditPage from "./pages/ScaleOfficeEditPage";
import ScaleOfficeMapPage from "./pages/ScaleOfficeMapPage";

type Route =
  | "/"
  | "/scale-offices"
  | "/scale-offices/edit"
  | "/highway-toll-offices"
  | "/highway-toll-offices/edit"
  | "/overload-checkpoints";

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  if (
    hash === "/scale-offices" ||
    hash === "/scale-offices/edit" ||
    hash === "/highway-toll-offices" ||
    hash === "/highway-toll-offices/edit" ||
    hash === "/overload-checkpoints"
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

  if (route === "/overload-checkpoints") {
    return <OverloadCheckpointMapPage />;
  }

  return <HomePage />;
}
