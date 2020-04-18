FROM phusion/baseimage

CMD ["/sbin/my_init"]

RUN curl -sL https://deb.nodesource.com/setup_12.x | bash -
RUN apt-get -y install nodejs

RUN mkdir /server
COPY server/dist/index.js /server
COPY container/etc/service/server/run /etc/service/server/run
RUN chmod +x /etc/service/server/run

RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
