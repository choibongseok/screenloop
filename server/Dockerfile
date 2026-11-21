FROM eclipse-temurin:21-jre
COPY build/libs/screenloop-server.jar /app/screenloop-server.jar
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/screenloop-server.jar"]
