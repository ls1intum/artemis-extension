// Turns the raw recording of `npm run screencast:docs` into the finished video. Reads
// reports/screencast/raw.mp4 and the timeline the spec wrote next to it, keeps the scenes,
// drops the waits the spec marked as cuts, and writes screencast.mp4 plus the voice-over at its
// times in the finished video: voice-over.vtt per scene, voice-over.json per sentence (where
// scripts/screencast-recorder places each take).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'reports', 'screencast');
const HEIGHT = 1080;

/** The kept parts of [start, end], in milliseconds of the raw recording. */
function keptSegments(start, end, cuts) {
    const segments = [];
    let cursor = start;
    for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
        if (cut.end <= cursor || cut.start >= end) {
            continue;
        }
        if (cut.start > cursor) {
            segments.push({ start: cursor, end: cut.start });
        }
        cursor = Math.max(cursor, cut.end);
    }
    if (cursor < end) {
        segments.push({ start: cursor, end });
    }
    return segments;
}

/** Where a moment of the raw recording lands in the finished video. */
function finalTime(t, segments) {
    let elapsed = 0;
    for (const segment of segments) {
        if (t <= segment.start) {
            break;
        }
        elapsed += Math.min(t, segment.end) - segment.start;
    }
    return elapsed;
}

function vttTime(ms) {
    const total = Math.max(0, Math.round(ms));
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
}

function main() {
    const timeline = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'timeline.json'), 'utf8'));
    if (!timeline.recorded || timeline.scenes.length === 0) {
        console.log('Nothing recorded, nothing to render.');
        return;
    }
    const scenes = [...timeline.scenes].sort((a, b) => a.start - b.start);
    const segments = keptSegments(scenes[0].start, scenes[scenes.length - 1].end, timeline.cuts);

    const parts = segments.map((s, i) => `[0:v]trim=start=${s.start / 1000}:end=${s.end / 1000},setpts=PTS-STARTPTS[v${i}]`);
    const filter = `${parts.join(';')};${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0,scale=-2:${HEIGHT}:flags=lanczos,format=yuv420p[out]`;
    const output = path.join(OUT_DIR, 'screencast.mp4');
    execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', path.join(OUT_DIR, 'raw.mp4'),
        '-filter_complex', filter, '-map', '[out]',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart',
        output,
    ], { stdio: 'inherit' });

    const cues = scenes.map(scene => `${scene.id}\n${vttTime(finalTime(scene.start, segments))} --> ${vttTime(finalTime(scene.end, segments))}\n${scene.voiceOver}\n`);
    fs.writeFileSync(path.join(OUT_DIR, 'voice-over.vtt'), `WEBVTT\n\n${cues.join('\n')}`);

    const sentences = scenes.map(scene => ({
        id: scene.id,
        start: finalTime(scene.start, segments) / 1000,
        end: finalTime(scene.end, segments) / 1000,
        sentences: scene.sentences.map(sentence => ({ text: sentence.text, start: finalTime(sentence.at, segments) / 1000 })),
    }));
    fs.writeFileSync(path.join(OUT_DIR, 'voice-over.json'), `${JSON.stringify(sentences, null, 2)}\n`);

    const length = segments.reduce((sum, s) => sum + s.end - s.start, 0);
    console.log(`Wrote ${output} (${vttTime(length)}), voice-over.vtt and voice-over.json`);
}

main();
