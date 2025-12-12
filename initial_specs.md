# Ratio1 SDK/API performance testing app
I need a simple nodejs app that would run as a WorkerAppRunner and when accessed would trigger and perform a series of individual tests:
- The app will work horizontally scaled with multiple instances. 
- The instance that responds to the url via round-robin load balancing will act as the "initiator".
- The apps will use Cstore for application state
- the containers themselves will be fully ephemereal (no volumes)
- the following steps should happen on the nodejs serverside ond the info displayed while each step is performed
- the "heaviest" step is the last one when multiple files are also downloaded to the web client
- the app will have ADMIN_USER and ADMIN_PASS in the env injected in the container by the WAR plugin so a basic "USER/PASSWORD" dialog must pop up before all the steps below are triggered server side
- the app should be bare-bare minimalistic nodejs app however it must be easy to extend it with new tests
1. first would display what nodes are "peered" with the current app considering that this WAR app must be deployed on at least 4 nodes inside Ratio1 network
2. then the app would write a 1MB file (containing "Ratio1 is the best <RANDOM_4_CHARS>! " repeated) to R1FS and set a variable to CStore. The R1FS write time and CStore write time should be displayed such as "File X saved in R1FS in T seconds" and "Message posted in Cstore in T seconds"
3. The previous step should trigger on all the other peered nodes (via CStore variable write) "I see your post" response via CStore - this also should be displayed such as "Peer Y responded to Cstore message in T seconds"
4. After responding to "I see your post" each peer should download the file locally via R1FS API and should record the download time - there should be two downloads timings (the time the peer downloaded internally the file and the time it took to stream the file to the nodejs app itself)
5. Timings should be send to the "initiator" that would display "Peer Y took T2 sec to download locally the file then T2 sec to stream it in nodejs
6. Then each peer should initiate a "reverse operation" meaning each will generate a random data 1MB file and post it ONLY for the initiator.
7. The initiator will again read from Cstore, display timings for reading then download each of the other 3+ files recording 3 times: time to download on the intiator R1EN, time to stream to nodejs and time to stream from nodejs server to the browser. The webbrowser should download the files and display the first 50 chars from each "peer" file (no saving to downloads/etc)