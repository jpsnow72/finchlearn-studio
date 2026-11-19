# Built-in Lottie pack (issue #100)

26 animated icons vendored from the Generative Icons library
(https://generativeicons.com), LottieFiles' open animated icon set.
License: MIT (per the library's API metadata). Source per file:
https://generativeicons.com/assets/<id>.lottie

Files: play-pause, download, export-file, arrow-up, arrow-right,
arrow-left, star, star-rating, trophy, microphone, camera, video-call,
message, chat-widget, calendar, clock, alarm-clock, warning,
banner-alert, lightbulb, brainstorm, ask-question, quiz, confetti,
heart, bell.

Format: dotLottie (zip with manifest.json + animations/*.json).
Playback uses the dotLottie player; exports frame-render the same
player so stage and MP4 agree. Recolor hooks: the set shares color
slots, exposed in the inspector when a Lottie object is selected.
