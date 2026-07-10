# Skill Add-on: Google Docs Export

Apply this section after the Sensei evaluation has been fully researched, written, and quality-checked.

## Export trigger

When the `exportSenseiEvaluation` action is available, export every finished L1 or L2 report after presenting the final report to the user, unless the user explicitly says not to export it.

Do not call the exporter for:

- drafts
- partial evaluations
- research notes
- source lists
- internal analysis
- abandoned or failed evaluations

## Export payload

Call `exportSenseiEvaluation` with:

- `projectName`: project name only
- `evaluationType`: `L1` or `L2`
- `decision`: one of the four permitted labels
- `reportMarkdown`: final report only
- `sharedSecret`: the configured private exporter secret

Permitted decisions:

- `Soft approve`
- `Strongly approved`
- `Soft Decline`
- `Declined`

## Tab title

The exporter creates the title automatically:

- `[Project Name] L1`
- `[Project Name] L2`

Never add dates, decisions, or extra labels to `projectName` unless the user explicitly requests a different naming convention.

## Content rules

Export only the clean final evaluation.

Exclude:

- citations required only for the chat response
- research/reference links, except team profile links allowed by the evaluation rules
- source notes
- confidence notes not intended for the final report
- tool output
- internal reasoning
- preambles and postambles addressed to the user

Preserve:

- report title
- section headings
- paragraph order
- Sensei bullet symbols
- team profile links
- L2 scores
- total score
- final decision wording

## Duplicate handling

Never overwrite an existing tab. The exporter automatically creates a unique suffix such as `- 2` or `- 3`.

## Completion response

After a successful export, state:

`Exported to Google Docs: [Tab Title]`

Then provide the returned direct `documentUrl`.

If export fails, keep the completed evaluation intact and report the exporter error plainly. Do not regenerate or alter the evaluation merely because export failed.
