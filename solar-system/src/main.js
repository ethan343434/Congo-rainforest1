// Sol Voyager — entry point.
import { Game } from './game/game.js';

const game = new Game(window.SOL_SYSTEM || 'sol');
game.load();
// Handy for debugging from the console (and used by the automated tests).
window.solar = game;
