import { notFound } from 'next/navigation';
import WizardClient from './WizardClient';

type PageProps = {
  params: Promise<{ claim_code: string }>;
};

// Setup wizard entry point. Reached as /setup/{claim_code} after the
// operator scans the sticker QR code (or types the URL printed on it).
// See docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md.
export default async function SetupPage({ params }: PageProps) {
  const { claim_code } = await params;

  // Basic shape check — real validation happens server-side on each API call.
  // Claim codes are short alphanumeric tokens; reject obviously-malformed URLs
  // before rendering the wizard.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(claim_code)) {
    notFound();
  }

  return <WizardClient claimCode={claim_code} />;
}
