from subprocess import call
import sys
call( ["node", "/opt/splunk/bin/scripts/poll_activities.js"] + sys.argv )