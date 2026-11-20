# Built-in Lottie pack (issue #100)

26 animated icons vendored from the Generative Icons library
(https://generativeicons.com), LottieFiles' open animated icon set.
License: MIT (per the library's API metadata). Per icon license
records live in licenses.json beside the assets. Source per file:
https://generativeicons.com/assets/<id>.lottie

Files: play-pause, download, export-file, arrow-up, arrow-right,
arrow-left, star, star-rating, trophy, microphone, camera, video-call,
message, chat-widget, calendar, clock, alarm-clock, warning,
banner-alert, lightbulb, brainstorm, ask-question, quiz, confetti,
heart, bell.

Not bundled: receipt-confirmed. The id does not exist in the
Generative Icons catalogue (the asset URL returns 404 and the API
answers not_found), so it is recorded as blocked in licenses.json
rather than substituted with a different icon.

Format: dotLottie (zip with manifest.json + animations/*.json).
Playback uses the shared deterministic Lottie renderer in
apps/editor/src/lottie/lottieCore.ts: the stage and the export paths
sample the same frames from the scene clock, so stage and MP4 agree.
Recolor hooks: the set shares the color.primary color slot, exposed
in the inspector when a Lottie object is selected.
