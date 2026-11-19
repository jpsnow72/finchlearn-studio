import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./shell";
import "./studio.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
