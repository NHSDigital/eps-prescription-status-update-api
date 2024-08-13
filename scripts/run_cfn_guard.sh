#!/usr/bin/env bash
set -eou pipefail

rm -rf /tmp/ruleset
wget -O /tmp/ruleset.zip https://github.com/aws-cloudformation/aws-guard-rules-registry/releases/download/1.0.2/ruleset-build-v1.0.2.zip  >/dev/null 2>&1
unzip /tmp/ruleset.zip -d /tmp/ruleset/  >/dev/null 2>&1 

curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/aws-cloudformation/cloudformation-guard/main/install-guard.sh | sh >/dev/null 2>&1

mkdir -p cfn_guard_output

~/.guard/bin/cfn-guard validate \
    --data SAMtemplates \
    --rules /tmp/ruleset/output/ncsc.guard \
    --show-summary fail \
    > cfn_guard_output/SAMtemplates.txt

rm -rf /tmp/ruleset
