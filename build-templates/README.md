# 检查与打包模板

这些文件是随源码分发的普通 YAML 模板，**当前没有启用 GitHub Actions**。本次推送使用的 GitHub OAuth 授权没有 `workflow` scope，因此不向 `.github/workflows/` 写入执行配置。

`1.1.0` 的 macOS Apple Silicon 安装包由本机完成构建、测试、签名及 DMG 校验后发布。模板存在不代表 GitHub 托管 runner 已成功验证 Intel Mac、Windows 或 Linux。

- [ci.yml](ci.yml)：启用后在 push / pull request 执行离线检查，真实 Apple 接口测试只由手动 `workflow_dispatch` 触发。
- [packages.yml](packages.yml)：启用后仅支持手动 `workflow_dispatch`，在各平台原生构建，验证签名或安装后上传 Actions artifacts；不创建 Release、不生成更新清单、不需要 Tauri 更新签名私钥。

如果以后有相应的仓库权限和 `workflow` 授权，可自行复制模板启用：

```bash
mkdir -p .github/workflows
cp build-templates/ci.yml .github/workflows/ci.yml
cp build-templates/packages.yml .github/workflows/packages.yml
```

启用前应检查 runner、依赖和 action 版本，确认该环境的验证范围。不同平台的安装包应在对应平台实际验证后再公开发布。
