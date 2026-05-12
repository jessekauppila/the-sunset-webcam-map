// app/components/ModelAnalysis/GlossaryTerm.tsx
'use client';

import { ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ML_GLOSSARY } from '@/app/lib/mlGlossary';

interface Props {
  slug: string;
  children: ReactNode;
  withIcon?: boolean;
}

export function GlossaryTerm({ slug, children, withIcon }: Props) {
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
          textDecoration: withIcon ? 'none' : 'underline dotted',
          textDecorationColor: 'currentColor',
          textUnderlineOffset: '3px',
          cursor: 'help',
          display: withIcon ? 'inline-flex' : undefined,
          alignItems: withIcon ? 'center' : undefined,
          gap: withIcon ? 4 : undefined,
        }}
      >
        {children}
        {withIcon && (
          <InfoOutlinedIcon
            fontSize="inherit"
            aria-hidden
            sx={{ fontSize: '0.9em', opacity: 0.65 }}
          />
        )}
      </span>
    </Tooltip>
  );
}
