FROM node:argon
MAINTAINER Matt Smith

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Bundle app source
COPY lib /usr/src/app

CMD ["chmod", "a+x bin/www"]
CMD ["npm", "start"]
