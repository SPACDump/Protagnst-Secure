async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
// Promise and only resolve the promise after the timeout,
// Effectively halting the program for the specified amount of time

module.exports = { sleep };