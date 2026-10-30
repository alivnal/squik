export class CompressionCancelledError extends Error {
  constructor() {
    super('Compression cancelled.');
    this.name = 'CompressionCancelledError';
  }
}

/**
 * The output cannot be brought under the size cap: even the lowest tier at the
 * bitrate floors is too big for the video's length, or every encode overshot.
 * The message is the one shown to the user.
 */
export class OutputTooLargeError extends Error {
  constructor(
    message: string,
    readonly maxOutputBytes: number,
  ) {
    super(message);
    this.name = 'OutputTooLargeError';
  }
}
