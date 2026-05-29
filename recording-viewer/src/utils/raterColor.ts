/**
 * Stable lane color for a rater id. Same id → same hue. Legacy lane uses
 * a neutral gray to distinguish it from real rater lanes.
 */
export function raterLaneColor(raterId: string): string {
    if (raterId === 'legacy') return 'hsl(0 0% 50%)';
    let h = 0;
    for (let i = 0; i < raterId.length; i++) h = (h * 31 + raterId.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 60%)`;
}
