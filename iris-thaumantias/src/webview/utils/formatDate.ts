export function formatDate(dateString?: string): string {
    if (!dateString) {
        return 'No date';
    }
    return new Date(dateString).toLocaleDateString();
}

export function formatDateTime(dateString?: string): string {
    if (!dateString) {
        return 'No date';
    }
    return new Date(dateString).toLocaleString();
}
