'use strict';

const { setupServer } = require('msw/node');
const { http, HttpResponse } = require('msw');

/**
 * Shared msw server for generate.js E2E tests.
 *
 * generate.js makes three different types of DeepSeek calls:
 *   1. Resume generation   (system: resume_prompt.md)
 *   2. Cover letter        (system: cover_letter_prompt.md)
 *   3. Quality assessment  (system: quality_prompt.md)
 *
 * This handler inspects the request body to determine which type of call
 * is being made and returns the appropriate mock response.
 *
 * Child processes use this via:
 *   NODE_OPTIONS='--require ./tests/helpers/msw-generate-setup.js'
 */

const RESUME_RESPONSE_CONTENT = `# Adam Buteux, MBA, CISSP, CIPM
Portland, Oregon (open to relocation) | adam@adambuteux.com | 929-218-3981 | linkedin.com/in/adambuteux

## Summary
Senior governance and privacy professional with 15+ years driving compliance programs at scale.

## Professional Experience

### Meta | Senior Manager, Privacy & Risk Review | June 2022–November 2025
*Led enterprise AI risk review across Facebook, Instagram, and Messenger.*
- **Reduced regulatory response time by 40%.** Redesigned the DMA compliance workflow across 10 product teams, cutting average cycle from 21 to 12 days.

### Audible (Amazon) | Director, Privacy Operations | January 2019–May 2022
*Oversaw global privacy program for 35M+ subscriber platform.*
- **Achieved GDPR certification ahead of deadline.** Delivered data mapping and consent infrastructure 3 months early across 6 workstreams.

### PwC Advisory | Director, Risk, Cybersecurity, and Privacy | March 2015–December 2018
*Privacy and GRC engagements for Fortune 500 clients.*
- **Built privacy program from scratch for a $4B healthcare client.** HIPAA-compliant governance framework adopted across 12 business units.

## Independent Projects

### RiskHelper.ai | Co-Founder & Head of Product | December 2025–Present
AI governance SaaS; product strategy, compliance framework, go-to-market.

## Education
**Executive MBA** — Bayes Business School, London
**BSc Computer Science with Management** — King's College London

## Certifications
CISSP | CIPM`;

const COVER_LETTER_RESPONSE_CONTENT = `# Cover Letter — Meridian Health Systems | Senior Privacy Manager

Privacy program leadership at scale is where my background is strongest, and the scope of this role — standing up a governance function across a multi-site health system — maps directly to what I built at Meta and Audible.

At Meta, the harder part wasn't the compliance work itself. It was building the internal infrastructure to make 10 product teams capable of self-assessing risk before shipping. That is the same muscle this role needs.

I'd like to talk.`;

const QUALITY_RESPONSE_CONTENT = JSON.stringify({
  resume_quality: 7,
  cover_letter_quality: 6,
  pillars_selected: ['Program Leadership', 'Risk Governance'],
  cover_letter_paras: 2,
  quality_note: 'Strong pillar selection. Cover letter P2 cut — no specific angle available from JD.',
});

const QUALITY_RESPONSE_FIELDS = [
  'resume_quality', 'cover_letter_quality',
  'pillars_selected', 'cover_letter_paras', 'quality_note',
];

const server = setupServer(
  http.post('https://api.deepseek.com/v1/chat/completions', async ({ request }) => {
    const body = await request.json();
    const userContent = (body.messages && body.messages[1] && body.messages[1].content) || '';
    const systemContent = (body.messages && body.messages[0] && body.messages[0].content) || '';

    // Determine call type based on prompt content
    let responseContent;

    if (userContent.includes('PILLAR LIBRARY:')) {
      // Resume generation call — user prompt contains the PILLAR LIBRARY section
      responseContent = RESUME_RESPONSE_CONTENT;
    } else if (userContent.includes('GENERATED RESUME:')) {
      // Cover letter generation call — user prompt contains the GENERATED RESUME section
      // Also check for quality_prompt system text to disambiguate
      if (systemContent.includes('quality assessor') || systemContent.includes('Quality scoring')) {
        // Quality assessment call — system prompt has QA instructions
        responseContent = QUALITY_RESPONSE_CONTENT;
      } else {
        // Cover letter call
        responseContent = COVER_LETTER_RESPONSE_CONTENT;
      }
    } else if (userContent.includes('GENERATED COVER LETTER:')) {
      // Quality assessment call
      responseContent = QUALITY_RESPONSE_CONTENT;
    } else if (systemContent.includes('quality assessor') || systemContent.includes('Quality scoring')) {
      // Fallback: quality check by system prompt
      responseContent = QUALITY_RESPONSE_CONTENT;
    } else {
      // Default fallback — scoring response (should not happen in generate.js tests)
      responseContent = JSON.stringify({
        score: 7,
        fit_signal: 'Strong alignment on governance program leadership and enterprise compliance scope.',
        gap: 'No direct healthcare domain experience.',
      });
    }

    return HttpResponse.json({
      choices: [{ message: { content: responseContent } }],
    });
  })
);

server.listen({ onUnhandledRequest: 'bypass' });
