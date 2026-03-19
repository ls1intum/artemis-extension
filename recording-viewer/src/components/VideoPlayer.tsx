import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';

export interface VideoPlayerHandle {
    seekToSessionTimestamp(ts: number): void;
    getCurrentSessionTimestamp(): number;
    isPaused(): boolean;
}

interface Props {
    sessionStartTime: number;
    sessionEndTime: number;
    videoTimeAtSessionStartSeconds: number;
    videoUrl: string;
    videoTimeRef: React.RefObject<number>;
    onPlayStateChange: (isPlaying: boolean) => void;
}

function formatVideoTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
    { sessionStartTime, sessionEndTime, videoTimeAtSessionStartSeconds, videoUrl, videoTimeRef, onPlayStateChange },
    ref,
) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const scrubRef = useRef<HTMLInputElement>(null);
    const isProgrammaticSeek = useRef(false);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

    // Convert between video time and session timestamp
    const videoTimeToSession = useCallback((videoTime: number) => {
        return sessionStartTime + (videoTime - videoTimeAtSessionStartSeconds) * 1000;
    }, [sessionStartTime, videoTimeAtSessionStartSeconds]);

    const sessionToVideoTime = useCallback((timestamp: number) => {
        return (timestamp - sessionStartTime) / 1000 + videoTimeAtSessionStartSeconds;
    }, [sessionStartTime, videoTimeAtSessionStartSeconds]);

    useImperativeHandle(ref, () => ({
        seekToSessionTimestamp(ts: number) {
            const video = videoRef.current;
            if (!video) return;
            const vt = sessionToVideoTime(ts);
            isProgrammaticSeek.current = true;
            video.currentTime = Math.max(0, Math.min(vt, video.duration || Infinity));
        },
        getCurrentSessionTimestamp() {
            return videoTimeToSession(videoRef.current?.currentTime ?? 0);
        },
        isPaused() {
            return videoRef.current?.paused ?? true;
        },
    }), [sessionToVideoTime, videoTimeToSession]);

    // Frame callback: update videoTimeRef with current session timestamp
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let rafId: number;

        if ('requestVideoFrameCallback' in video) {
            const onFrame = () => {
                if (!isProgrammaticSeek.current) {
                    (videoTimeRef as React.MutableRefObject<number>).current = videoTimeToSession(video.currentTime);
                }
                setCurrentTime(video.currentTime);
                rafId = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(onFrame);
            };
            rafId = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(onFrame);
            return () => {
                (video as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(rafId);
            };
        } else {
            // Fallback: requestAnimationFrame
            const onFrame = () => {
                if (!isProgrammaticSeek.current) {
                    (videoTimeRef as React.MutableRefObject<number>).current = videoTimeToSession(video.currentTime);
                }
                setCurrentTime(video.currentTime);
                rafId = requestAnimationFrame(onFrame);
            };
            rafId = requestAnimationFrame(onFrame);
            return () => cancelAnimationFrame(rafId);
        }
    }, [videoTimeRef, videoTimeToSession]);

    // Clear programmatic seek flag on seeked event
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onSeeked = () => {
            isProgrammaticSeek.current = false;
            (videoTimeRef as React.MutableRefObject<number>).current = videoTimeToSession(video.currentTime);
        };
        video.addEventListener('seeked', onSeeked);
        return () => video.removeEventListener('seeked', onSeeked);
    }, [videoTimeRef, videoTimeToSession]);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }, []);

    const handlePlayPause = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const isPlaying = !video.paused;
        setPlaying(isPlaying);
        onPlayStateChange(isPlaying);
    }, [onPlayStateChange]);

    const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;
        isProgrammaticSeek.current = true;
        video.currentTime = Number(e.target.value);
    }, []);

    const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;
        const v = Number(e.target.value);
        video.volume = v;
        setVolume(v);
        if (v > 0 && video.muted) {
            video.muted = false;
            setMuted(false);
        }
    }, []);

    const toggleMute = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setMuted(video.muted);
    }, []);

    const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const video = videoRef.current;
        if (!video) return;
        const rate = Number(e.target.value);
        video.playbackRate = rate;
        setPlaybackRate(rate);
    }, []);

    // Global keyboard shortcuts: arrows to skip, space to play/pause
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

            const video = videoRef.current;
            if (!video) return;

            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const delta = e.shiftKey ? 0.5 : 5;
                const direction = e.key === 'ArrowRight' ? 1 : -1;
                isProgrammaticSeek.current = true;
                video.currentTime = Math.max(0, Math.min(video.currentTime + delta * direction, video.duration || Infinity));
            } else if (e.key === ' ') {
                e.preventDefault();
                if (video.paused) video.play();
                else video.pause();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div className="video-player">
            <video
                ref={videoRef}
                src={videoUrl}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
                onPlay={handlePlayPause}
                onPause={handlePlayPause}
                preload="metadata"
            />
            <div className="video-controls">
                <button className="video-play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                    {playing ? '\u23F8' : '\u25B6'}
                </button>
                <span className="video-time mono">
                    {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                </span>
                <div className="video-scrub-container">
                    {duration > 0 && (() => {
                        const sessionStartVideo = videoTimeAtSessionStartSeconds;
                        const sessionEndVideo = sessionToVideoTime(sessionEndTime);
                        const left = Math.max(0, sessionStartVideo / duration) * 100;
                        const right = Math.min(1, sessionEndVideo / duration) * 100;
                        return (
                            <div
                                className="video-session-range"
                                style={{ left: `${left}%`, width: `${right - left}%` }}
                                title="Session timeline range"
                            />
                        );
                    })()}
                    <input
                        ref={scrubRef}
                        type="range"
                        className="video-scrub-bar"
                        min={0}
                        max={duration || 1}
                        step={0.1}
                        value={currentTime}
                        onChange={handleScrub}
                    />
                </div>
                <button className="video-mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
                    {muted || volume === 0 ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
                </button>
                <input
                    type="range"
                    className="video-volume-bar"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={handleVolumeChange}
                    title={`Volume: ${Math.round((muted ? 0 : volume) * 100)}%`}
                />
                <select
                    className="video-speed-select"
                    value={playbackRate}
                    onChange={handleSpeedChange}
                    title="Playback speed"
                >
                    {SPEED_OPTIONS.map(s => (
                        <option key={s} value={s}>{s === 1 ? '1x' : `${s}x`}</option>
                    ))}
                </select>
                <div className="video-shortcuts-wrapper">
                    <span className="video-shortcuts-btn">?</span>
                    <div className="video-shortcuts-popup">
                        <div className="shortcut-row"><kbd>Space</kbd> Play / Pause</div>
                        <div className="shortcut-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> Skip 5s</div>
                        <div className="shortcut-row"><kbd>Shift</kbd>+<kbd>&larr;</kbd> <kbd>&rarr;</kbd> Skip 0.5s</div>
                    </div>
                </div>
            </div>
        </div>
    );
});
