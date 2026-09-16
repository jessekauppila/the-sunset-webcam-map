import { soloFontClassName } from '@/app/kiosk/soloFonts';

/**
 * The public mirrors' shell: black, the whole window, the picture centered.
 *
 * A route group, so `/sunrise`, `/sunset` and `/mirror` share this shell
 * without carrying a segment of their own in the URL — the links are the
 * short ones a visitor can be sent.
 *
 * The solo fonts come from the kiosk's own bundle, so a caption here is set
 * in the face the glass is setting it in rather than something close to it.
 * The cursor stays visible: hiding it is the gallery's rule for a room with
 * no keyboard in it, not a rule for someone's laptop.
 */
export default function MirrorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`bg-black w-screen h-screen overflow-hidden flex items-center justify-center ${soloFontClassName}`}
    >
      {children}
    </div>
  );
}
