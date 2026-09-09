/**
 * Jobbet kunden väntar på, sett från webbläsaren.
 *
 * Id:t sparas lokalt: det är nyckeln till jobbet för den som inte är
 * inloggad, och det gör att beskedet hittar tillbaka även om fliken laddas om
 * medan assistenten arbetar.
 */

const KEY = "inkab.draftJob.v1";

export function rememberJob(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Privat läge eller full lagring: jobbet går ändå, beskedet gäller bara
    // den här fliken.
  }
}

export function currentJobId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetJob() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* strunt samma */
  }
}
