/**
 * "server-only" kastar när den importeras utanför en servermiljö. I bygget är
 * det precis vad vi vill — det är skyddet som hindrar prisboken från att hamna
 * i klientbundlen. I vitest kör allt i Node, så paketet stubbas här. Skyddet i
 * produktionsbygget är oförändrat.
 */
export {};
