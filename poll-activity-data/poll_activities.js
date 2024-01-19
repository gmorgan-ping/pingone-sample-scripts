const axios = require('axios');
const moment = require('moment-timezone');
const fs = require('fs').promises;

const STATUS_FILE = "/Applications/Splunk/bin/scripts/status.json";
const ENV_ID = process.env.PINGONE_ENV_ID;
const CLIENT_ID = process.env.PINGONE_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_CLIENT_SECRET;

const PING_ONE_REGIONS = {
    'NA': 'com',
    'CA': 'ca',
    'EU': 'eu',
    'AP': 'asia'
}

const PING_ONE_DOMAIN = PING_ONE_REGIONS['NA'];

const tokenAuthRequestOptions = {
    method: 'POST',
    url: `https://auth.pingone.${PING_ONE_DOMAIN}/${ENV_ID}/as/token`,
    headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: `grant_type=client_credentials&scope=p1:read:env:activity&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
};

const activitiesRequestOptions = (accessToken, accessTokenType, range) => {
    const url = `https://api.pingone.${PING_ONE_DOMAIN}/v1/environments/${ENV_ID}/activities?filter=createdat%20ge%20%22{lowerbound}%22%20and%20createdat%20le%20%22{upperbound}%22&limit=500`;
    if (!range) {
        range = [
            moment().tz('utc').subtract(5, 'minutes').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
            moment().tz('utc').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z'
        ];
    }
    return {
        method: 'GET',
        url,
        headers: {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `${accessTokenType} ${accessToken}`
        },
        params: { lowerbound: range[0], upperbound: range[1] },
        forever: true
    };
};

const getAllActivities = async (range) => {
    let done = false;
    let token = null;
    let count = 0;

    while (!done) {
        if (!token) {
            try {
                const tokenResponse = await axios(tokenAuthRequestOptions);
                const uri = options ? options.uri : null;
                options = activitiesRequestOptions(tokenResponse.data.access_token, tokenResponse.data.token_type, range);
                if (uri) options.uri = uri;
            } catch (err) {
                console.error("Failed to get token for some unexpected reason", err);
                done = true;
            }
        }

        try {
            const results = await axios(options);
            count++;
            const end = new Date();

            if (results.data._links && results.data._links.next && results.data._links.next.href) {
                options.url = results.data._links.next.href;
            } else {
                done = true;
                return range;
            }

            const activities = results.data._embedded.activities;
            const stringResults = JSON.stringify(activities);
            const finalContent = (count === 1 ? "[" : "") + stringResults.substring(1, stringResults.length - 1);
            finalContent += done ? ']' : ', ';
            console.log(finalContent);
        } catch (err) {
            if (err.response && (err.response.status === 401 || err.response.status === 403)) {
                token = null;
            } else {
                done = true;
                console.error("Unexpected error. Quitting loop", err);
            }
        }
    }
};

//***********************************//
//file access and status read/update //
//***********************************//
const initRequest = async () => {
    let status = { requested: [], finished: [] };
    let startDate = moment().tz('utc').startOf('minute').subtract(5, 'minutes').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
    let endDate = moment().tz('utc').startOf('minute').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
    try {
        let savedStatus = await getStatus();
        if (savedStatus) {
            status = savedStatus;
            // if we already have finished results, set the interval from last finished to now.
            if (status.finished.length) {
                startDate = status.finished[status.finished.length - 1][1];
            }
            // if we already have a request in the queue then no need to repeat the interval, use its finished
            // time as the start of this interval
            if (status.requested.length) {
                startDate = status.requested[status.requested.length - 1][1];
            }
        }
    } catch (err) {
        console.error(err);
        // file doesn't exist yet, so do nothing. 
    }
    // add a request for the last 5 minutes or last finished to now.
    if (startDate != endDate) {
        await updateStatus(status, [startDate, endDate]);
    }
};
const updateStatus = async (status, request) => {
    if (request) {
        addRequest(status, request)
    }
    balanceStatus(status);
    await fsWrite(STATUS_FILE, JSON.stringify(status));
};
const addRequest = (status, request) => {
    // don't add a dup
    if (status.requested.filter(r => r[0] === request[0] && r[1] === request[1]).length === 0) {
        status.requested = status.requested.concat([request]);
    }
};
// Prune the finished list:
// if [n].end == [n+1].start => [n].end = [n+1].end, remove [n+1].
const balanceStatus = async (status) => {
    status.finished = status.finished.reduce((p, c) => {
        if (!p.length) {
            p.push(c);
        } else if (p[p.length - 1][1] == c[0]) {
            p[p.length - 1][1] = c[1]
        } else {
            p.push(c);
        }
        return p;
    }, []);
};
const getStatus = async () => {
    try {
        let status = await fsRead(STATUS_FILE);
        return JSON.parse(status);
    } catch (err) {
        console.error("failed to read file from cwd: ", process.cwd());
        return null;
    }
};

const fsWrite = (filename, content) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filename, content, (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
};

const fsRead = (filename) => {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, (err, content) => {
            if (err) reject(err);
            else resolve(content);
        });
    });
};

const rp = axios;

// Main program
const program = async () => {
    await initRequest();
    const status = await getStatus();
    const finished = {};

    for (const range of status.requested) {
        const result = await getAllActivities(range);
        if (result) {
            finished[range[0] + range[1]] = result;
        }

        const updatedStatus = status.requested.reduce((p, c) => {
            if (c[0] + c[1] in finished) {
                p.finished.push(c);
            } else {
                p.requested.push(c);
            }
            return p;
        }, { requested: [], finished: status.finished });

        updateStatus(updatedStatus);
    }
};

program().catch(console.error);