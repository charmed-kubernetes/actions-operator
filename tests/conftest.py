import pytest


def pytest_addoption(parser):
    parser.addoption("--addons", action="store", default=None)


@pytest.fixture(scope="session")
def addons(request):
    addons = request.config.option.addons
    if addons is None:
        pytest.skip()
    return addons
