# Poll activity data

Use the scripts in this directory to poll the PingOne for Customers API for activity data.

```shell
docker build -t patrickcping/splunk .
```

```shell
docker run -d -p 8000:8000 -v `pwd`:/opt/splunk/bin/scripts \
  -e "SPLUNK_START_ARGS=--accept-license" \
  -e "SPLUNK_PASSWORD=2Federate" \
  -e "PINGONE_ENV_ID=<<envid>" \
  -e "PINGONE_CLIENT_ID=<<clientid>>" \
  -e "PINGONE_CLIENT_SECRET=<<secret>>" \
  -e "PINGONE_REGION=<<region>>" \
  --name splunk patrickcping/splunk:latest
```

```shell
docker exec -it splunk sh -c "sudo vi etc/apps/search/local/props.conf"
```

```
[test]
DATETIME_CONFIG =
INDEXED_EXTRACTIONS = json
NO_BINARY_CHECK = true
TIMESTAMP_FIELDS = createdAt
TIME_FORMAT = %Y-%m-%dT%H:%M:%S.%l
TZ = GMT
category = Structured
description = json audit events
pulldown_type = 1
```
(where `test` is the "source type" in splunk)