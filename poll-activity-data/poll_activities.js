const axios = require('axios');
const moment = require('moment-timezone');
const fs = require('fs');

const STATUS_FILE = "/tmp/status.json";
const ENV_ID = process.env.PINGONE_ENV_ID;
const CLIENT_ID = process.env.PINGONE_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_CLIENT_SECRET;
const REGION = process.env.PINGONE_REGION;
const DATA_PERIOD_MINUTES = 5;


const PING_ONE_REGIONS = {
  'NA': 'com',
  'CA': 'ca',
  'EU': 'eu',
  'AP': 'asia'
}

var pingOneDomain = PING_ONE_REGIONS['NA'];
if (REGION) {
  pingOneDomain = PING_ONE_REGIONS[REGION];
}

const tokenAuthRequestOptions = {
  method: 'POST',
  url: `https://auth.pingone.${pingOneDomain}/${ENV_ID}/as/token`,
  headers: {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  data: `grant_type=client_credentials&scope=p1:read:env:activity&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
};

const activitiesRequestOptions = (accessToken, accessTokenType, range) => {
  var url = `https://api.pingone.${pingOneDomain}/v1/environments/${ENV_ID}/activities?filter=createdat%20ge%20%22{lowerbound}%22%20and%20createdat%20le%20%22{upperbound}%22&limit=500`;

  if (!range) {
    range = [
      moment().tz('utc').subtract(DATA_PERIOD_MINUTES, 'minutes').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
      moment().tz('utc').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z'
    ];
  }

  url = url.replace("{lowerbound}", range[0])
    .replace("{upperbound}", range[1]);

  return {
    method: 'GET',
    url,
    headers: {
      'Cache-Control': 'no-cache',
      // 'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Authorization': `${accessTokenType} ${accessToken}`
    },
    forever: true
  };
};

const getAllActivities = async (range) => {
  var options;
  let done = false;
  let token = null;
  let count = 0;
  let invalidTokenCount = 0;

  while (!done && invalidTokenCount < 20) {
    if (!token) {
      try {
        const tokenResponse = await axios(tokenAuthRequestOptions);
        if (tokenResponse.data.access_token != null && tokenResponse.data.access_token != "") {
          invalidTokenCount = 0;
        }
        const uri = options ? options.url : null;

        options = activitiesRequestOptions(tokenResponse.data.access_token, tokenResponse.data.token_type, range);

        if (uri) options.url = uri;
      } catch (err) {
        console.error("Failed to get token for some unexpected reason", err);
        done = true;
      }
    }

    try {
      count++;
      var results = await axios(options);
      var end = new Date();

      // prep the next cursor for next iteration
      if (results.data._links && results.data._links.next && results.data._links.next.href) {
        options.url = results.data._links.next.href;
      } else {
        done = true;
      }

      // print results
      let activities = results.data._embedded.activities;
      let stringResults = JSON.stringify(activities);
      let finalContent = ((count === 1) ? "[" : "") + stringResults.substring(1, stringResults.length - 1);
      finalContent += (done) ? ']' : ', ';
      console.log(finalContent);

    } catch (err) {
      // console.log('err', err);

      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        // token expired, let's reset it so a new one will be fetched at the beginning of the loop.
        token = null;
        invalidTokenCount++;
        console.error("Response status: ", err.response.status, " - resetting token, count ", invalidTokenCount);
      } else {
        done = true;
        console.error("unexpected error. quitting loop", err);
      }
    }
  }

  return range;
};

//***********************************//
//file access and status read/update //
//***********************************//
const initRequest = async () => {
  let status = { requested: [], finished: [] };
  let startDate = moment().tz('utc').startOf('minute').subtract(DATA_PERIOD_MINUTES, 'minutes').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
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
    console.error("failed to read file: ", err.toString());
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


// Main program
const program = async () => {
  await initRequest();
  let status = await getStatus();
  let finished = {};
  // iterate through every range in the requested node
  for (var i = 0; i < status.requested.length; i++) {
    let range = status.requested[i];
    let result = await getAllActivities(range);
    if (result) {
      // add this range to the finished list
      finished[range[0] + range[1]] = result;
    }

    // update anything that finished from requested to finished.
    let updatedStatus = status.requested.reduce((p, c) => {
      if (c[0] + c[1] in finished) {
        p.finished = p.finished.concat([c]);
      } else {
        p.requested = p.requested.concat([c]);
      }
      return p;
    }, { "requested": [], "finished": status.finished });
    updateStatus(updatedStatus);
  }
};

program().catch(console.error);