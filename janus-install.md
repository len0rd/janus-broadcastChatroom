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

3. Install Janus
```bash
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus --disable-all-plugins --enable-javascript-es-module --enable-plugin-videoroom --disable-unix-sockets --disable-websockets
sudo su
make
exit
```

install certs in the certs folder

4. Install our config files for Janus (TODO)

5. install in opt:
```bash
make install
```


avoid 512bit certs

