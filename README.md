#Team report radiator
This is a service to connect to Trello, confluence and gitlab to locate metrics and populates a team radiator

##Pre-requisites
Start by ensuring that you have Docker and Docker compose installed. If you do not please follow use the installer for your system https://docs.docker.com/windows/.

If this is the first time you have used Docker on Windows or Mac OSX then you will need to create a default VM to run your containers in. Follow https://docs.docker.com/engine/installation/windows/ which will help you create a default machine for running the containers in.

To find the IP address you will need to connect to the HTML interface, run the following command in your preferred shell;
```
> docker-machine ip
```

##Running the radiator
If you have all the Pre-requisites and you know the IP address of your exposed Docker containers then you are ready to run the radiator. Call the following from your shell;

```bash
$ docker-compose up
```
