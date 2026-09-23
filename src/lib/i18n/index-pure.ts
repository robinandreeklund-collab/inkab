/**
 * Ordlistan utan React.
 *
 * index.ts bär krokarna och är därför en klientmodul. Tester och servern
 * behöver samma texter utan att dra in ett komponentträd.
 */
export * from "./locale";
export * from "./translate";
export { MESSAGES, type Messages } from "./messages";
