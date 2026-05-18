import { createRoot } from "react-dom/client";
import App from "./App";
import AppSplash from "@/components/app-splash";
import { installSpaFormSubmitGuard } from "@/lib/spaFormSubmitGuard";
import "./index.css";

installSpaFormSubmitGuard();

createRoot(document.getElementById("root")!).render(
  <AppSplash>
    <App />
  </AppSplash>
);