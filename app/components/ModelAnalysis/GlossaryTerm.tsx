// app/components/ModelAnalysis/GlossaryTerm.tsx
'use client';

import { ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import { ML_GLOSSARY } from '@/app/lib/mlGlossary';

interface Props {
  slug: string;
  children: ReactNode;
}

export function GlossaryTerm({ slug, children }: Props) {
  const entry = ML_GLOSSARY[slug];
  if (!entry) {
    return <span className="glossary-term-unknown">{children}</span>;
  }
  return (
    <Tooltip
      title={entry.short}
      arrow
      enterDelay={200}
      enterTouchDelay={0}
      placement="top"
    >
      <span
        className="glossary-term"
        tabIndex={0}
        aria-label={`${entry.label}: ${entry.short}`}
        style={{
          textDecoration: 'underline dotted',
          textDecorationColor: 'currentColor',
          textUnderlineOffset: '3px',
          cursor: 'help',
        }}
      >
        {children}
      </span>
    </Tooltip>
  );
}
