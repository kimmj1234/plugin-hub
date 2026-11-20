import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

async function boot() {
  // Tauri 밖(브라우저)에서 개발 서버를 열면 가짜 데이터 모드로 동작한다.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await import("./devMock");
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
