export function createDownloadFilename(date = new Date()): string {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = twoDigits(date.getUTCMonth() + 1);
  const day = twoDigits(date.getUTCDate());
  const hour = twoDigits(date.getUTCHours());
  const minute = twoDigits(date.getUTCMinutes());
  const second = twoDigits(date.getUTCSeconds());
  return `ohz_${year}${month}${day}_${hour}${minute}${second}.jpg`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
