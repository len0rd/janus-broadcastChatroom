# Janus install

1. Install base dependencies
```bash
sudo apt-get install libmicrohttpd-dev libjansson-dev libnice-dev
    libssl-dev libsrtp-dev libsofia-sip-ua-dev libglib2.0-dev \
	libopus-dev libogg-dev libcurl4-openssl-dev liblua5.3-dev \
	pkg-config gengetopt libtool automake cmake 
```

2. Install libwebsockets
```bash
git clone git://git.libwebsockets.org/libwebsockets
cd libwebsockets
# If you want the stable version of libwebsockets, uncomment the next line
# git checkout v2.4-stable
mkdir build
cd build
# See https://github.com/meetecho/janus-gateway/issues/732 re: LWS_MAX_SMP
cmake -DLWS_MAX_SMP=1 -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_C_FLAGS="-fpic" ..
make && sudo make install
```

3. Install libsrtp 2.x
```bash
wget https://github.com/cisco/libsrtp/archive/v2.2.0.tar.gz
tar xfv v2.0.0.tar.gz
cd libsrtp-2.0.0
./configure --prefix=/usr --enable-openssl
make shared_library && sudo make install
```

4. Install npm(?)
```bash
sudo apt-get install nodejs npm
```

5. Install Janus
```bash
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus --disable-all-plugins --enable-javascript-es-module --enable-plugin-videoroom --disable-unix-sockets --disable-sample-event-handler
sudo su
make
exit
```

6. install certs in the certs folder
```bash
sudo cp conf/mycert.* /opt/janus/share/janus/certs
```
Or, generate your own self-signed certs:
```bash
openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout mycert.key -out mycert.pem
```

7. Install our config files for Janus
```bash
sudo cp conf/*.cfg /opt/janus/etc/janus
```

8. install in opt:
```bash
make install
```


avoid 512bit certs


# Communicate with Janus
Below is the basic structure of how to start a video room with Janus gateway

1. Create session with the Gateway

Send a POST request to create the session:

URL: `https://localhost:8089/janus`
```json
{
	"janus": "create",
	"transaction": "randomString"
}
```
If successful, Janus will return something like this:
```json
{
   "janus": "success",
   "transaction": "randomString",
   "data": {
      "id": sessionEndpointInteger
}
```
In CURL:
```bash
curl --header "Content-Type: application/json" -k --insecure --request POST --data '{ "janus": "create", "transaction": "randomString"}' https://localhost:8089/janus
```
**Note:** the `-k --insecure` parameters allow self-signed certificates to be used by CURL. This is useful in a development environment, but should be removed in any production scenario.

2. Attach to the videoroom plugin handle

Send a POST request to attach the session to the plugin handle:

URL: `https://localhost:8089/janus/sessionEndpointInteger`
```json
{
	"janus": "attach",
	"plugin": "janus.plugin.videoroom",
	"transaction": "differentRandomString",
	"opaque_id" : "optional identifier for user"
}
```
If successful, Janus will return something like this:
```json
{
   "janus": "success",
   "session_id": sessionEndpointInteger,
   "transaction": "differentRandomString",
   "data": {
      "id": pluginHandleEndpointInteger
   }
}
```
In CURL:
```bash
curl --header "Content-Type: application/json" -k --insecure --request POST --data '{ "janus": "attach", "plugin": "janus.plugin.videoroom", "transaction": "differentRandomString", "opaque_id" : "user123"}' https://localhost:8089/janus/sessionEndpointInteger
```

3. [Optional] Create a new room in the videoroom plugin

Send a POST request to create a new broadcast room:

URL: `https://localhost:8089/janus/sessionEndpointInteger/pluginHandleEndpointInteger`
```json
{
    "janus": "message",
    "transaction": "moreDifferentRandomString",
    "body": {
        "room": roomInteger,
        "request": "create",
        "publishers": 10,

        "record": false,
        "is_private": true,
        "fir_freq": 10,
        "bitrate": 128000
    }
}
```

Note: All the JSON fields following Publishers are optional. For more info, consult the documentation on the [videoroom plugin](https://janus.conf.meetecho.com/docs/videoroom.html).

