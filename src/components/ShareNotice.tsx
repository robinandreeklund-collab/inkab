"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { Button } from "./ui";

/**
 * Vad som hände med delningslänken.
 *
 * En trasig länk fick tidigare ingen reaktion alls — sidan visade
 * standardkonfigurationen, och den som klickade hade ingen chans att veta att
 * hen inte såg avsändarens anläggning. Det är det värsta av alla svar, så nu
 * står det här i stället.
 */
export function ShareNotice() {
  const notice = useConfigStore((s) => s.shareNotice);
  const dismiss = useConfigStore((s) => s.dismissShareNotice);
  const restore = useConfigStore((s) => s.restorePreviousDraft);

  if (!notice) return null;

  const broken = notice.kind !== "loaded";

  return (
    <div
      role="status"
      className={`no-print absolute left-1/2 top-3 z-30 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 border bg-white px-3 py-2 shadow-lg ${
        broken ? "border-danger" : "border-accent"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 text-[13px] leading-relaxed">
          {notice.kind === "loaded" ? (
            <>
              <strong>Delad konfiguration öppnad.</strong> Underlag{" "}
              <span className="num">{notice.reference}</span>. Ändringar du gör här påverkar
              inte avsändarens version — dela en ny länk om du vill skicka tillbaka dem.
              {notice.hadLocalDraft ? (
                <span className="block text-muted">
                  Ditt tidigare utkast finns kvar och går att hämta tillbaka.
                </span>
              ) : null}
            </>
          ) : notice.kind === "unreadable" ? (
            <>
              <strong>Länken gick inte att läsa.</strong> Den är troligen avhuggen på vägen —
              e-postklienter bryter långa länkar. Be avsändaren skicka den igen, gärna som
              klickbar länk och inte som text.
            </>
          ) : (
            <>
              <strong>Länken innehåller en konfiguration som inte gäller längre.</strong> Den
              är gjord i en äldre version av konfiguratorn. Be avsändaren öppna sin
              konfiguration och dela en ny länk.
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          {notice.kind === "loaded" && notice.hadLocalDraft ? (
            <Button size="sm" onClick={() => restore()}>
              Mitt tidigare utkast
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Stäng">
            Stäng
          </Button>
        </div>
      </div>
    </div>
  );
}
