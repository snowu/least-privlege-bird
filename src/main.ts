// Bundle entry point. game.ts runs all the canvas/UI setup and wires DOM events
// on import; it pulls in physics-core, scores, and clave. The inline <script> in
// index.html sets window.DEV_MODE / window.LIVE_DB before this bundle loads.
import './game.ts';
