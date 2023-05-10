const crypto = require('crypto');
require('dotenv').config( { 'path': __dirname+'/../.env' });
const algorithm = 'aes-256-ctr';
const secretKey = process.env.ENC_KEY || '2296360cf07bd1cf921bf6e941bbb7c4'; // crypto.randomBytes(16).toString('hex')
const iv = Buffer.from(process.env.ENC_IV || '26845fd69034937fb7c05846d2337720', 'hex'); // crypto.randomBytes(16).toString('hex')

const encrypt = (text) => {
    // This line creates a cipher object with the algorithm, secret key, and iv
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    // This line encrypts the text passed in using the cipher object and returns a buffer
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    // This line returns the buffer as a hex string
    return encrypted.toString('hex');
};

const decrypt = (hash) => {
    // This line creates a decipher object with the algorithm, secret key, and iv
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    // This line decrypts the hash passed in using the decipher object and returns a buffer
    const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash, 'hex')), decipher.final()]);
    // This line returns the buffer as a string
    return decrpyted.toString();
};

module.exports = { encrypt, decrypt };