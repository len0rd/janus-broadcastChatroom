# Config files

This demo uses the config files in this folder.

## tl;dr

Copy the config files to `JANUS_INSTALL/etc/janus`. Also install your own certificates in `JANUS_INSTALL/share/janus/certs`

## Installation

To install you first need to build, make and install the latest version of [Janus](https://github.com/meetecho/janus-gateway). We go over how to do this in the root [readme](../README.md).

With Janus installed, copy these files into the Janus config folder. You will likely need to do this with root. From the root of this repository:
```bash
sudo cp conf/*.cfg /opt/janus/etc/janus 
```
This assumes you installed Janus in the default `/opt/janus` folder.


Also included in this folder is a sample cert. The config files are setup to work with cert files of these names. You can try installing these sample certs, however it's probably best to generate your own (unless you have real/valid certs for your server):

```bash
# generate your own cert:
openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout mycert.key -out mycert.pem
# install for janus:
sudo cp mycert.* /opt/janus/share/janus/certs
```

## Config file overview

- janus.cfg

This file provides power top-level Janus server customization. Mainly addressing where things are located. The locations for other config files, certs, STUN/TURN servers and logs are all configured here.

- janus.plugin.audiobridge.cfg

This file allows configuration of the audiobridge. With it you can create static audio rooms that always exist on the server. This isn't particularly useful for our us as we dynamically create and destroy rooms. Currently we have the test room `1234` set in this config file, for basic setup testing. In production you would want to remove this. It would also be beneficial to add an admin_key to this config file for authentication.

- janus.plugin.streaming.cfg

Similar to the audiobridge config, this allow the setup of static stream mountpoints. At the moment, this file is completely commented out, but again in production it would be good to add an admin_key.

- janus.transport.http.cfg

This config exposes options for how the REST http api works. This configures what port/path the api endpoint is on, whether to use http or https, and what certs to use for the api. This also configures if you are able to access the admin api. By default we have this turned off, but it can be helpful in debugging. Currently we also allow only https connections. We recommend keeping this since many features of WebRTC are only accessible over https, and it's easier to enforce it on the user from the get-go.

