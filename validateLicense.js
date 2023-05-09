const axios = require('axios');
const { red, yellow, green } = require('chalk');
const { sleep } = require('./src/utilities/sleep');
require('dotenv').config();

let logo = yellow(`
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
─██████████████─████████████████───██████████████─██████████████─██████████████─██████████████─██████──────────██████─██████████████─██████████████─
─██░░░░░░░░░░██─██░░░░░░░░░░░░██───██░░░░░░░░░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░██████████──██░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─
─██░░██████░░██─██░░████████░░██───██░░██████░░██─██████░░██████─██░░██████░░██─██░░██████████─██░░░░░░░░░░██──██░░██─██░░██████████─██████░░██████─
─██░░██──██░░██─██░░██────██░░██───██░░██──██░░██─────██░░██─────██░░██──██░░██─██░░██─────────██░░██████░░██──██░░██─██░░██─────────────██░░██─────
─██░░██████░░██─██░░████████░░██───██░░██──██░░██─────██░░██─────██░░██████░░██─██░░██─────────██░░██──██░░██──██░░██─██░░██████████─────██░░██─────
─██░░░░░░░░░░██─██░░░░░░░░░░░░██───██░░██──██░░██─────██░░██─────██░░░░░░░░░░██─██░░██──██████─██░░██──██░░██──██░░██─██░░░░░░░░░░██─────██░░██─────
─██░░██████████─██░░██████░░████───██░░██──██░░██─────██░░██─────██░░██████░░██─██░░██──██░░██─██░░██──██░░██──██░░██─██████████░░██─────██░░██─────
─██░░██─────────██░░██──██░░██─────██░░██──██░░██─────██░░██─────██░░██──██░░██─██░░██──██░░██─██░░██──██░░██████░░██─────────██░░██─────██░░██─────
─██░░██─────────██░░██──██░░██████─██░░██████░░██─────██░░██─────██░░██──██░░██─██░░██████░░██─██░░██──██░░░░░░░░░░██─██████████░░██─────██░░██─────
─██░░██─────────██░░██──██░░░░░░██─██░░░░░░░░░░██─────██░░██─────██░░██──██░░██─██░░░░░░░░░░██─██░░██──██████████░░██─██░░░░░░░░░░██─────██░░██─────
─██████─────────██████──██████████─██████████████─────██████─────██████──██████─██████████████─██████──────────██████─██████████████─────██████─────
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
───────────────────────────────────────────────────────────────────────────────────────────────
─██████████████─██████████████─██████████████─██████──██████─████████████████───██████████████─
─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░██──██░░██─██░░░░░░░░░░░░██───██░░░░░░░░░░██─
─██░░██████████─██░░██████████─██░░██████████─██░░██──██░░██─██░░████████░░██───██░░██████████─
─██░░██─────────██░░██─────────██░░██─────────██░░██──██░░██─██░░██────██░░██───██░░██─────────       v${require('./package.json').version}
─██░░██████████─██░░██████████─██░░██─────────██░░██──██░░██─██░░████████░░██───██░░██████████─       https://protagnst.ca
─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░██─────────██░░██──██░░██─██░░░░░░░░░░░░██───██░░░░░░░░░░██─       
─██████████░░██─██░░██████████─██░░██─────────██░░██──██░░██─██░░██████░░████───██░░██████████─       © Jack Perry, 2022
─────────██░░██─██░░██─────────██░░██─────────██░░██──██░░██─██░░██──██░░██─────██░░██─────────       All Rights Reserved
─██████████░░██─██░░██████████─██░░██████████─██░░██████░░██─██░░██──██░░██████─██░░██████████─
─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░░░░░░░░░██─██░░██──██░░░░░░██─██░░░░░░░░░░██─
─██████████████─██████████████─██████████████─██████████████─██████──██████████─██████████████─
───────────────────────────────────────────────────────────────────────────────────────────────
`);

async function validateLicenseKey() {
	// Debug node env, skip if this is true (to stop wait times when hotreloading code)
    if (process.env.NODE_ENV === '01a40987-c34a-4868') return true;
	
	/**
	    = ENDPOINT DISABLED =
		This file isn't in use anymore because the external server
		That was in use for license verification is no longer live
		This file still showcases how the program *would* have handled it.
		
		An example request from the license api would be
		{ status_code: 200, data: {}, message: "Welcome back {USER} - License verified!" }
	**/
	return true;

    console.log(logo);

    const url = 'https://l.jx.wtf/api/client';
    const licensekey = '9R5PZ-YQ9QP-U7SAT-U4LTQ-KW5GY';
    const product = 'ProtagnstSecure';
    const version = '1.0';
    const public_api_key = '3c5deebc2e2136d761ec364e67dd25e1730eab39';

    try {
        const res = await axios.post(
            url,
            { licensekey, product, version, },
            { headers: { Authorization: public_api_key }, }
        );

        // Validate request body
        if (!res.data.status_code || !res.data.status_id) {
            console.log(`${red('[Licensing] There was an error activating your product.\n[Licensing] Please contact support (jack@protagnst.ca) with code LCSE_RETURN_CODE if the problem persists.')}`);
            return process.exit(1);
        }

        // Verify authentication
        if (res.data.status_overview !== 'success') {
            console.log(`${red('[Licensing] There was an error activating your product.\n[Licensing] Please contact support (jack@protagnst.ca) with code LCSE_NOT_STATUS_SUCCESS if the problem persists.')}`);
            console.log(res.data.status_msg);
            return process.exit(1);
        }

        const hash = res.data.status_id;

        // Split hash
        const hash_split = hash.split('694201337');

        // ---> Text based validation <---

        // Base64 decode the hash_split[0]
        const decoded_hash = Buffer.from(hash_split[0], 'base64').toString();

        // Get 2 first chars of licensekey
        const license_first = licensekey.substr(0, 2);

        // Get 2 last chars of licensekey
        const license_last = licensekey.substr(licensekey.length - 2);

        // Get 2 first characters of public_api_key
        const public_api_key_first = public_api_key.substr(0, 2);

        if (
            decoded_hash !==
            `${license_first}${license_last}${public_api_key_first}`
        ) {
            console.log(`${red('[Licensing] There was an error activating your product.\n[Licensing] Please contact support (jack@protagnst.ca) with code LCSE_DECODE_NOT_MATCH if the problem persists.')}`);
            return process.exit(1);
        }

        // ---> Time based validation <---

        // Get epoch time
        let epoch_time_full = Math.floor(Date.now() / 1000);

        // Remove 2 last characters of epoc_time
        const epoch_time = epoch_time_full
            .toString()
            .substr(0, epoch_time_full.toString().length - 2);

        if (parseInt(epoch_time) - parseInt(hash_split[1]) > 1) {
            console.log(`${red('[Licensing] There was an error activating your product.\n[Licensing] Please contact support (jack@protagnst.ca) with code LCSE_EPOCH_NOT_MATCH if the problem persists.')}`);
            return process.exit(1);
        }

        console.log(`${green('[Licensing] Product activated successfully!\n[Licensing] Please allow up to 5 seconds for the server to start...')}`);
        if (process.env.NODE_ENV === 'prod') await sleep(5000);
        console.clear();
        return true;
    } catch (err) {
        console.log(`${red('[Licensing] There was an error activating your product.\n[Licensing] Please contact support (jack@protagnst.ca) with code LCSE_CONTACT_SERVER_NULL if the problem persists.')}`);
        console.log(err);
        process.exit(1);
    }
};

module.exports = { validateLicenseKey };
