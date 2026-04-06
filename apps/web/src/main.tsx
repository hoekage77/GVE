import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./routes/__root";
import "./index.css";
import "./styles/layout.css";
import "./styles/chat.css";
import "./styles/auth.css";
import "./styles/landing.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
