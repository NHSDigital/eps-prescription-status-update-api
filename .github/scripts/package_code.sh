#!/usr/bin/env bash
set -e

# make sure asdf will work
cp .tool-versions ~/
rm -rf .aws-sam
export PATH=$PATH:$PWD/node_modules/.bin

# compile api spec
make compile-specification

# build main sam stack
make sam-build

# copy files needed into target directory and rename it
cp Makefile .aws-sam/build/
cp samconfig_package_and_deploy.toml .aws-sam/build/
mv .aws-sam/build .aws-sam/build.main

# build api domain sam stack
make sam-build-api-domain

# copy files needed into target directory and rename it
cp Makefile .aws-sam/build/
cp samconfig_package_and_deploy.toml .aws-sam/build/
mv .aws-sam/build .aws-sam/build.api_domain

# build table sam stack
make sam-build-tables

# copy files needed into target directory and rename it
cp Makefile .aws-sam/build/
cp samconfig_package_and_deploy.toml .aws-sam/build/
mv .aws-sam/build .aws-sam/build.tables

# copy api spec
mkdir -p .aws-sam/build/specification
cp packages/specification/dist/eps-prescription-status-update-api.resolved.json .aws-sam/build/specification/
cp packages/specification/dist/eps-custom-prescription-status-update-api.resolved.json .aws-sam/build/specification/

# copy deployment scripts
cp .github/scripts/release_code.sh .aws-sam/build/
cp .github/scripts/deploy_api.sh .aws-sam/build/
