import { createRoot } from "react-dom/client";
import App from "./App";
import AppSplash from "@/components/app-splash";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <AppSplash>
    <App />
  </AppSplash>
);