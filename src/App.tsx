import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import HighwayTollOfficeMapPage from "./pages/HighwayTollOfficeMapPage";
import ScaleOfficeMapPage from "./pages/ScaleOfficeMapPage";

type Route = "/" | "/scale-offices" | "/highway-toll-offices";

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  if (hash === "/scale-offices" || hash === "/highway-toll-offices") {
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

  if (route === "/highway-toll-offices") {
    return <HighwayTollOfficeMapPage />;
  }

  return <HomePage />;
}
