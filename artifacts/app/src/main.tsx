import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// In production on Render, VITE_API_URL is set to the backend service URL
// e.g. https://iwhatappbot.onrender.com
// In dev/Replit, it's not set and relative /api/... URLs work fine.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
