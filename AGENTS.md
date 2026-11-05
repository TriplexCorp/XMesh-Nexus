# Panel UI requirements

- Every user-facing control, page, dialog, tooltip, notification, validation error,
  empty/loading state, and asynchronous message must have clear, natural English
  as well as Russian. This applies throughout the panel, including login and MFA.
- Preserve user-provided names, configuration JSON, protocol identifiers, URLs,
  credentials, and other technical data verbatim. Never translate their contents.
- Do not add untranslated-copy baselines or suppress missing translations to pass CI.
- Verify English after rendering and after interactions, including dynamic counts
  and error states. New UI work must pass the repository's English checks.
- Keep global material, border, radius, typography, and keyboard-focus settings.
