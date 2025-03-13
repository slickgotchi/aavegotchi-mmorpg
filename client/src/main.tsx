import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// createRoot(document.getElementById('root')!).render(<App />)
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
window.onbeforeunload = () => {
    root.unmount(); // Unmount React tree
    // Optionally force a full page reload
    window.location.reload();
};
