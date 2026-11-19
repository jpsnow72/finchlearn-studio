import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./shell";
import { RenderHost } from "./renderHost";
import "./studio.css";

const isRenderNode = new URLSearchParams(window.location.search).has("render");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isRenderNode ? <RenderHost /> : <Root />}</StrictMode>,
);
