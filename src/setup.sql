CREATE DATABASE IF NOT EXISTS protagnstsecure;
USE protagnstsecure;

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  discord_id varchar(255) PRIMARY KEY NOT NULL
);