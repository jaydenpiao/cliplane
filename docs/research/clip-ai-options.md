# Cheap transcription and clip analysis

Checked 2026-11-16 against the primary sources linked below. This is a research
decision and an isolated smoke benchmark, not a runtime integration or deployment.
No paid inference or Google Cloud API calls were made for this research.

## Recommendation

Start with **faster-whisper on CPU, `base.en`, int8, with its integrated Silero VAD**
for English transcription. Keep `tiny.en` as a lower-compute option. Combine the
transcript with Cliplane's existing FFmpeg audio/scene candidates; keep the existing
fallback when speech is absent. This provides searchable speech and editable caption
timings without an inference vendor charge. Hosting, storage and maintenance still
cost money. General Google Cloud compute credits may fund the worker if the particular
grant covers that compute service; Vertex/Gemini eligibility is a separate question.

Cliplane currently ranks audio energy, scene activity and boundaries in
`workers/media/pipeline.py`; it has no ASR or learned gameplay understanding. Audio
energy can nominate gunfire or shouting, but cannot establish a kill, a win or a good
story. ASR adds what people said; a transcript alone cannot reliably identify silent
gameplay highlights. The existing muted gameplay sample cannot test transcription.

| Option                                                                                                                               | Where it fits                                                                                                    | Main tradeoff                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper), `base.en` / `tiny.en`                                                   | First choice for the existing Python worker; CPU int8, integrated VAD and word timestamps                        | Small models can miss slang, quiet speech and overlapping microphones; Python/native dependencies need a pinned, tested image |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp)                                                                               | Alternative for a small native worker, desktop packaging or CPU-specific acceleration; supports quantized models | Adds a C++ build/binary boundary; benchmark on the target CPU before selecting it over the existing Python path               |
| [Gemini 3.1 Flash-Lite on Google Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite) | Optional later step: rerank existing candidates using bounded transcript excerpts and return structured JSON     | External data transfer, metered tokens, access and credit eligibility; text reranking does not verify gameplay events         |

The two ASR engines are MIT licensed. The selected
[SYSTRAN converted model card](https://huggingface.co/Systran/faster-whisper-tiny.en)
also declares MIT; preserve the applicable engine/model notices when packaging.
[Silero VAD](https://github.com/snakers4/silero-vad) is MIT licensed. Use the ONNX VAD
already shipped with faster-whisper; a separate Torch installation is unnecessary for
this path. No GPU, large LLM, diarization or forced-alignment stack is required for the
first experiment.

## Actual CPU smoke benchmark

Ran in a disposable venv under `/workspace/work/clip-ai`, outside the repository and
without changing application dependencies. Input was the 11-second JFK presidential
speech fixture from the [official Whisper tests](https://github.com/openai/whisper/blob/main/tests/jfk.flac),
plus generated digital silence and a copy with five seconds of silence prepended.
This public-domain US presidential speech is a clean English smoke fixture, not a
gaming accuracy dataset. SHA-256 of the downloaded FLAC:
`63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715`.

Environment: x86-64 AMD EPYC 9V74 virtual CPU, three visible CPUs; inference explicitly
used two CPU threads and one worker. Python 3.12.14; faster-whisper 1.2.1,
CTranslate2 4.9.0, ONNX Runtime 1.32.0, NumPy 2.5.5. Settings: `device="cpu"`,
`compute_type="int8"`, `language="en"`, `beam_size=1`, `vad_filter=True`,
`word_timestamps=True`, `condition_on_previous_text=False`. Timings consume the full
segments generator and include VAD/decoding, excluding downloads, model load and
FFmpeg conversion to a 16 kHz mono float array. No batching or GPU was used.

RTF = inference wall seconds / source seconds; lower is faster.

| Model   | Fixture                   | Source seconds | Wall seconds |   RTF | Result                            |
| ------- | ------------------------- | -------------: | -----------: | ----: | --------------------------------- |
| tiny.en | JFK speech                |             11 |        0.740 | 0.067 | All expected words; two segments  |
| base.en | JFK speech                |             11 |        0.879 | 0.080 | All expected words; one segment   |
| tiny.en | Digital silence           |             11 |        0.024 | 0.002 | Empty transcript; zero VAD speech |
| base.en | Digital silence           |             11 |        0.034 | 0.003 | Empty transcript; zero VAD speech |
| tiny.en | Five-second silence + JFK |             16 |        0.669 | 0.042 | First word starts at 4.94 seconds |
| base.en | Five-second silence + JFK |             16 |        0.827 | 0.052 | First word starts at 4.94 seconds |

Both speech outputs matched the known spoken words after ignoring punctuation/case.
This is one famous, short, potentially familiar recording, one run per configuration;
it establishes execution and basic sanity, not a quality score, stable throughput or
superiority of one model. Empty digital silence does not establish immunity to music,
game sound or microphone noise. Peak process RSS was about 455 MiB across sequential
model loads; this is not a measured production memory requirement.

Public model downloads took 13.04 seconds for tiny.en and 26.03 seconds for base.en;
model loads took 0.37 and 0.68 seconds respectively. Tested HF revisions:

- `Systran/faster-whisper-tiny.en`: `0d3d19a32d3338f10357c0889762bd8d64bbdeba`.
- `Systran/faster-whisper-base.en`: `3d3d5dee26484f91867d81cb899cfcf72b96be6c`.

The benchmark script, frozen scratch requirements, complete words/timings and logs
remain in `/workspace/work/clip-ai/{benchmark.py,requirements.txt,results.json,benchmark.log}`.
Only model data/config/tokenizer files were fetched from the official SYSTRAN HF
repositories, without remote-code execution. A fresh install selected PyAV 19.0.2;
the faster-whisper filename decoder failed with
`TypeError: open() got an unexpected keyword argument 'metadata_errors'`. Passing
the existing FFmpeg-decoded float array avoided that decoder path. Resolve/pin this
compatibility in a future worker image rather than assuming an unpinned install works.

## What the numbers mean for cost

Open-source inference has **$0 model/API usage charge**, not $0 infrastructure cost.
For a concrete planning example, current
[Cloud Run Jobs us-central1 list pricing](https://cloud.google.com/run/pricing)
is $0.000018/vCPU-second and $0.000002/GiB-second. A hypothetical two-vCPU,
two-GiB worker therefore costs:

`worker hour = 3600 × (2 × 0.000018 + 2 × 0.000002) = $0.144`.

| Assumed sustained RTF | Compute cost per source hour | Per 1,000 source hours |
| --------------------- | ---------------------------: | ---------------------: |
| 0.1                   |                      $0.0144 |                 $14.40 |
| 0.5                   |                      $0.0720 |                 $72.00 |
| 1.0                   |                      $0.1440 |                $144.00 |

These are scenarios, not measured Cloud Run results. They exclude cold starts,
minimum task billing, decoding/proxies/renders, retries, idle time, storage, network,
database, taxes and free-tier/credit discounts. The short local RTF must not be used
as a production capacity promise. Measure a long authorized recording on the selected
worker size before setting quotas; bake or cache pinned model weights instead of
downloading them on every job.

For optional **text-only** semantic reranking, current
[Google Cloud model pricing](https://cloud.google.com/model-garden/pricing)
lists `gemini-3.1-flash-lite` global standard input at $0.25/million tokens and
output, including reasoning, at $1.50/million. Flex/Batch prices are $0.125/$0.75.
Assume one request per source hour, 12,000 total input tokens for instructions,
candidate data and transcript excerpts, and 1,000 total billable output tokens:

`12,000 / 1,000,000 × $0.25 + 1,000 / 1,000,000 × $1.50 = $0.0045`.

That is $4.50 per 1,000 source hours for standard reranking, or $2.25 at the listed
batch rates, excluding the other costs above. Additional requests/retries scale the
cost. Non-global standard rates are $0.275/$1.65. A full hour of raw video/audio is
not covered by this text-token estimate. Use application result caching first; vendor
context-cache charges and hit rates are not assumed here.

## Google Cloud credits and availability

The current [model documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite)
lists 3.1 Flash-Lite as GA, with structured output and batch inference, released
2026-05-07 and retirement 2027-05-07 or later; supported locations include `global`,
`us` and `eu`. The [lifecycle table](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)
lists 2.5 Flash-Lite retirement as 2026-10-20, so do not start a new dependency on it.
Availability in documentation does not establish access for this project.

Credit coverage remains **account/grant specific and unverified**. The current
[Free Trial restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features?hl=en)
state that the $300 Welcome credit cannot pay Gemini platform services, formerly
Vertex AI, when signing up for a free trial **or upgrading to a paid account on or
after 2026-11-16**. That condition does not establish whether an existing account or
other grant qualifies. Before any charge, check the actual grant's eligible services,
signup/upgrade conditions, remaining value and expiry privately. General compute
coverage and Gemini coverage must be checked separately. Gemini Developer API / AI
Studio billing is separate and its pricing/free tier does not demonstrate that Google
Cloud credits apply. No account details belong in this document.

## First implementation boundary and quality checks

The next bounded experiment should add optional ASR after decoder isolation, using
one approved source at a time. Extract speech at 16 kHz, prefer a separate microphone
track when present, and retain a map back to original media time. Preserve source
offsets when VAD cuts silence or when decoding chunks. Word timestamps are estimates:
the offset fixture restored the first word to 4.94 seconds, but one base.en word
boundary moved 1.40 seconds beyond the expected five-second shift. They are not
frame-accurate edit boundaries or forced alignment. Preview captions and keep edits
bound to the approved source/revision.

Use multilingual `base`/`small` instead of `.en` for non-English speech and test the
actual languages; the English-only models cannot cover multilingual gaming reliably.
Evaluate quiet/cheap microphones, compressed voice chat, accents, code switching,
overlapping teammates, slang, music-only and game-only audio. VAD may mistake effects
for speech or discard quiet speech. Whisper may invent text or repeat phrases, as its
[official model card](https://github.com/openai/whisper/blob/main/model-card.md)
documents. Keep no-speech/uncertain output explicit and do not turn uncertain words
into confident captions. Neither small-model ASR nor VAD provides speaker identity.

Cache per workspace using immutable source hash, selected audio track, decoder/VAD
settings, model revision, language and ASR settings. Cache reranking separately by
transcript hash, candidate IDs, model and prompt/schema version. Do not retranscribe
when only a crop or title changes; honor deletion and retention across all derivatives.
Start a trial with a 30-minute/source limit, two source hours/workspace/day, one ASR
job at a time, bounded wall time and one controlled retry; make these explicit pilot
settings, then adjust from measured throughput and accepted-candidate yield. If cloud
reranking is later enabled, cap input/output tokens, request count and spend in the
application; billing alerts alone do not stop spend. These limits are proposals, not
present product behavior.

Keep source audio and transcripts private to the workspace; skip cloud transfer by
default. If the optional cloud step is enabled, send only needed candidate excerpts
and confirm its location, retention/logging configuration and account eligibility.
Treat transcript and OCR text as untrusted content, never instructions. Validate a
rerank response against existing candidate IDs and source bounds; reject invented
timestamps/events and fall back to deterministic ranking on errors. AI suggestions
do not clear rights, approve an edit, render an unapproved revision or authorize
publication. Preserve the existing human approval boundary.
